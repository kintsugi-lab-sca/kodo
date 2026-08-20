// @ts-check
//
// test/integration/e2e-smoke.test.js — KODO-26: el bucle completo contra git DE VERDAD.
//
// Los tests con stub congelan el contrato; este congela que los COMANDOS son los correctos.
// Ningún stub detecta un `rev-list` con los flags cambiados, un `diff` con dos puntos en vez de
// tres o un `--ff-only` que en realidad crea un merge commit — y esas tres son justamente las
// piezas que hacen que la cola diga la verdad. Molde: la sección «E2E smoke (git real)» de
// test/stop-worktree-cleanup.test.js.
//
// Repo real en un tmpdir; el store va por DI (espía/stub), así que el `~/.kodo/state.json` del
// operador NO se toca en ningún caso de este fichero.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureIntegration } from '../../src/integration/capture.js';
import { runIntegrateActionCli } from '../../src/cli/integrate.js';

/** git real, misma forma que el `gitFn` de producción (stdout trimeado, lanza en exit != 0). */
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();

let repo;

/** Repo con `main` y una rama `feature-docs` de 2 commits de documentación por encima. */
before(() => {
  repo = mkdtempSync(join(tmpdir(), 'kodo-int-e2e-'));
  git(repo, ['init', '-b', 'main']);
  git(repo, ['config', 'user.email', 'test@kodo.local']);
  git(repo, ['config', 'user.name', 'kodo test']);
  writeFileSync(join(repo, 'README.md'), '# base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base']);

  git(repo, ['switch', '-c', 'feature-docs']);
  writeFileSync(join(repo, 'README.md'), '# base\nuna línea nueva\n');
  git(repo, ['commit', '-am', 'docs: amplía el readme']);
  mkdirSync(join(repo, 'docs'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'guia.md'), 'guía\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'docs: guía']);
  git(repo, ['switch', 'main']);
});

after(() => rmSync(repo, { recursive: true, force: true }));

/** Espía de encolado con la forma de retorno del store. */
function spyEnqueue() {
  const calls = [];
  return {
    calls,
    enqueueFn: (input) => {
      calls.push(input);
      return { ok: true, value: { entry: { ...input, status: 'pending' }, deduped: false } };
    },
  };
}

describe('E2E (git real): captura de una rama con trabajo sin integrar', () => {
  it('lee rama, conteo, base, base_ok y diff correctos, y sugiere ff', async () => {
    const { enqueueFn, calls } = spyEnqueue();
    const r = await captureIntegration({
      session: { task_ref: 'KODO-26', task_id: 'uuid-26', project_path: repo, session_id: 's1' },
      // Sin worktree: la rama se lee del repo. Se hace el checkout a la rama primero para
      // simular el estado en el que cierra una sesión.
      worktree: null,
      gitFn: (cwd, args) => git(cwd, args),
      enqueueFn,
    });
    // La sesión cierra CON la rama checkouteada.
    assert.equal(r.captured, false, 'sobre main no hay nada que encolar (is-base)');
    assert.equal(r.reason, 'is-base');
    assert.deepEqual(calls, []);

    git(repo, ['switch', 'feature-docs']);
    const { enqueueFn: enqueue2, calls: calls2 } = spyEnqueue();
    const r2 = await captureIntegration({
      session: { task_ref: 'KODO-26', task_id: 'uuid-26', project_path: repo, session_id: 's1' },
      worktree: null,
      gitFn: (cwd, args) => git(cwd, args),
      enqueueFn: enqueue2,
    });

    assert.equal(r2.captured, true);
    assert.equal(calls2[0].branch, 'feature-docs');
    assert.equal(calls2[0].base_branch, 'main');
    assert.equal(calls2[0].commits_ahead, 2, 'los 2 commits que solo viven en la rama');
    assert.equal(calls2[0].base_ok, true, 'la rama contiene main entero');
    assert.equal(calls2[0].files_changed, 2, 'README.md + docs/guia.md');
    assert.equal(calls2[0].suggested, 'ff', 'docs-only con base al día');
    git(repo, ['switch', 'main']);
  });

  it('si main avanza por debajo, base_ok pasa a false y la sugerencia deja de ser ff', async () => {
    // Commit nuevo en main que la rama no tiene: exactamente el escenario del DoD.
    writeFileSync(join(repo, 'otro.md'), 'otro\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'docs: otro fichero en main']);

    git(repo, ['switch', 'feature-docs']);
    const { enqueueFn, calls } = spyEnqueue();
    await captureIntegration({
      session: { task_ref: 'KODO-26', project_path: repo, session_id: 's1' },
      worktree: null,
      gitFn: (cwd, args) => git(cwd, args),
      enqueueFn,
    });
    git(repo, ['switch', 'main']);

    assert.equal(calls[0].base_ok, false, 'la base avanzó por debajo');
    assert.notEqual(calls[0].suggested, 'ff', 'y por tanto el ff ya no se sugiere');
    assert.equal(calls[0].suggested, 'merge');
  });
});

describe('E2E (git real): ejecución de la acción', () => {
  it('--ff sobre una base atrasada FALLA de verdad y no deja el repo a medias', async () => {
    const before = git(repo, ['rev-parse', 'HEAD']);
    const resolveCalls = [];
    const code = await runIntegrateActionCli(
      'KODO-26',
      { ff: true },
      {
        findFn: () => ({
          task_ref: 'KODO-26', task_id: null, project_path: repo, branch: 'feature-docs',
          base_branch: 'main', commits_ahead: 2, base_ok: false, files_changed: 2, lines_changed: 3,
          suggested: 'merge', status: 'pending', created_at: '2026-08-20T10:00:00.000Z',
          updated_at: '2026-08-20T10:00:00.000Z', action: null, sha: null, outcome: null, resolved_at: null,
        }),
        resolveFn: (ref, patch) => { resolveCalls.push(patch); return { ok: true, value: {} }; },
        gitFn: (cwd, args) => git(cwd, args),
        loggerFn: () => ({ info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }),
        writeFn: () => {},
        errFn: () => {},
      },
    );

    assert.equal(code, 1, 'git rechaza el fast-forward');
    assert.equal(git(repo, ['rev-parse', 'HEAD']), before, 'HEAD intacto');
    assert.equal(git(repo, ['status', '--porcelain']), '', 'el worktree queda limpio');
    assert.deepEqual(resolveCalls, [], 'la entrada sigue pendiente');
  });

  it('--merge integra de verdad, devuelve el sha real y deja main con el trabajo', async () => {
    const out = [];
    const resolveCalls = [];
    const code = await runIntegrateActionCli(
      'KODO-26',
      { merge: true },
      {
        findFn: () => ({
          task_ref: 'KODO-26', task_id: null, project_path: repo, branch: 'feature-docs',
          base_branch: 'main', commits_ahead: 2, base_ok: false, files_changed: 2, lines_changed: 3,
          suggested: 'merge', status: 'pending', created_at: '2026-08-20T10:00:00.000Z',
          updated_at: '2026-08-20T10:00:00.000Z', action: null, sha: null, outcome: null, resolved_at: null,
        }),
        resolveFn: (ref, patch) => { resolveCalls.push(patch); return { ok: true, value: {} }; },
        gitFn: (cwd, args) => git(cwd, args),
        loggerFn: () => ({ info() {}, warn() {}, error() {}, debug() {}, child() { return this; } }),
        writeFn: (s) => out.push(s),
        errFn: (s) => out.push(s),
      },
    );

    assert.equal(code, 0);
    const head = git(repo, ['rev-parse', 'HEAD']);
    assert.equal(resolveCalls[0].sha, head, 'el sha persistido es el HEAD real tras el merge');
    assert.equal(resolveCalls[0].outcome, 'merged');
    assert.match(git(repo, ['log', '-1', '--pretty=%s']), /Merge branch 'feature-docs' \(KODO-26\)/);
    assert.equal(git(repo, ['branch', '--show-current']), 'main');
    // Y ahora la rama YA no tiene trabajo propio: el gate de KODO-21 la daría por integrada.
    const left = git(repo, ['rev-list', '--count', 'feature-docs', '--not', '--exclude=feature-docs', '--branches', '--remotes']);
    assert.equal(left, '0', 'tras el merge la captura ya no encolaría esta rama');
  });

  it('la rama sigue existiendo tras integrar (borrarla es del carril de cleanup, no de aquí)', () => {
    assert.match(git(repo, ['branch', '--list', 'feature-docs']), /feature-docs/);
  });
});
