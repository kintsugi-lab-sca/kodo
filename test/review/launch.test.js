// @ts-check
//
// test/review/launch.test.js — KODO-75: la sesión de revisión y su worktree.
//
// Dos propiedades se congelan aquí, y las dos son estructurales, no cosméticas:
//
//   1. EL MARCADOR. La línea que se teclea empieza por `KODO_REVIEWER=1`. Sin ese prefijo el
//      gate de `review/guard.js` no se abre y el reviewer no puede commitear nada — así que
//      este assert no comprueba un formato, comprueba que el rol existe.
//
//   2. EL WORKTREE SOBRE LA MISMA RAMA. `git worktree add <path> <branch>` hace CHECKOUT de la
//      rama que el coder dejó, y NO crea una rama nueva. Es la diferencia entre un reviewer
//      que anota sobre el trabajo revisado y uno que escribe en una historia paralela que
//      nadie va a leer. Se verifica contra un repo git REAL.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildReviewerCommand,
  buildReviewerPrompt,
  computeReviewWorktreePath,
  provisionReviewWorktree,
  removeReviewWorktree,
  resolveBaseBranch,
  REVIEW_WORKTREE_PREFIX,
} from '../../src/review/launch.js';

/** Config mínima con la forma que `getAgentDef` espera. */
const CONFIG = /** @type {any} */ ({
  claude: { default_model: 'opus', flags: [] },
  agents: {
    default: 'claude-code',
    registry: {
      'claude-code': {
        binary: 'claude',
        model_flag: '--model',
        session_id_flag: '--session-id',
        worktree_flag: '--worktree',
        skip_perms_flag: '--dangerously-skip-permissions',
        prompt_style: 'positional',
        status_authority: 'hooks',
      },
    },
  },
});

describe('KODO-75 — buildReviewerCommand: el marcador es el rol', () => {
  it('prefija KODO_REVIEWER=1 — sin él el guard no deja commitear nada', () => {
    const cmd = buildReviewerCommand(CONFIG, 'sid-1', 'revisa esto');
    assert.ok(cmd.startsWith('KODO_REVIEWER=1 claude '), `prefijo de entorno esperado\n${cmd}`);
    assert.match(cmd, /--session-id sid-1/);
    assert.match(cmd, /--model opus/);
  });

  it('NO emite --dangerously-skip-permissions: el rol cuya razón de ser es tener la superficie estrecha no la amplía gratis', () => {
    const cmd = buildReviewerCommand(CONFIG, 'sid-1', 'x');
    assert.ok(!cmd.includes('skip-permissions'), `no debe saltarse permisos\n${cmd}`);
  });

  it('escapa las comillas simples del prompt (la línea se TECLEA, y las simples son lo único que neutraliza $ y backtick)', () => {
    const cmd = buildReviewerCommand(CONFIG, 'sid-1', "no 'toques' $(rm -rf /) `x`");
    assert.match(cmd, /'\\''toques'\\''/);
    // El prompt entero va entre comillas simples, así que `$(...)` viaja literal.
    assert.ok(cmd.includes('$(rm -rf /)'), 'el texto viaja literal, sin expandirse');
  });

  it('usa default_model, el MISMO que las sesiones de trabajo — un reviewer más barato encuentra menos', () => {
    const cfg = { ...CONFIG, claude: { ...CONFIG.claude, default_model: 'sonnet', orchestrator_model: 'fable' } };
    const cmd = buildReviewerCommand(/** @type {any} */ (cfg), 's', 'x');
    assert.match(cmd, /--model sonnet/);
    assert.ok(!cmd.includes('fable'), 'no hereda el modelo barato del orquestador');
  });
});

describe('KODO-75 — buildReviewerPrompt', () => {
  it('sustituye todos los placeholders y no deja ninguno crudo', () => {
    const p = buildReviewerPrompt({
      task_ref: 'KODO-75',
      branch: 'feat/review',
      project_path: '/repo/kodo',
      reviewed_head: 'a'.repeat(40),
      base_branch: 'main',
      round: 2,
      max_rounds: 3,
      next_recommendation: '002-recommendations.md',
    });
    assert.ok(!/\{\{\w+\}\}/.test(p), `quedaron placeholders sin sustituir:\n${p.match(/\{\{\w+\}\}/g)}`);
    assert.match(p, /KODO-75/);
    assert.match(p, /002-recommendations\.md/);
    assert.match(p, /ronda 2 de un máximo de 3/);
  });

  it('el prompt DICE la restricción de escritura y que no debe arreglar', () => {
    const p = buildReviewerPrompt(/** @type {any} */ ({ task_ref: 'X', round: 1, max_rounds: 3 }));
    assert.match(p, /review\/.*y nada más|`review\/`, y nada más/);
    assert.match(p, /escríbelo.*no lo arregles/i);
  });

  it('sin base resuelta cae a main en vez de dejar el placeholder', () => {
    const p = buildReviewerPrompt(/** @type {any} */ ({ task_ref: 'X', base_branch: null, round: 1, max_rounds: 3 }));
    assert.ok(!p.includes('{{base_branch}}'));
    assert.match(p, /main\.\.HEAD/);
  });
});

describe('KODO-75 — el worktree de revisión sobre un repo git real', () => {
  /** @type {string} */
  let repo;
  const git = (args, cwd = repo) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'kodo-rlaunch-'));
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@example.com']);
    git(['config', 'user.name', 'T']);
    git(['config', 'commit.gpgsign', 'false']);
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(join(repo, 'src', 'p.js'), '1\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'base']);
    // La rama del coder, con trabajo encima.
    git(['checkout', '-q', '-b', 'feat/trabajo']);
    writeFileSync(join(repo, 'src', 'p.js'), '2\n');
    git(['commit', '-q', '-am', 'trabajo del coder']);
    git(['checkout', '-q', 'main']);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('el path es determinístico y lleva el prefijo review-', () => {
    const p = computeReviewWorktreePath('/repo', 'sid-9');
    assert.equal(p, join('/repo', '.claude', 'worktrees', `${REVIEW_WORKTREE_PREFIX}sid-9`));
  });

  it('hace CHECKOUT de la rama existente — NO crea una rama nueva', () => {
    const r = provisionReviewWorktree({ projectPath: repo, branch: 'feat/trabajo', sessionId: 'sid-1' });
    assert.equal(r.ok, true);
    const dir = /** @type {any} */ (r).path;
    assert.ok(existsSync(dir));
    assert.equal(git(['branch', '--show-current'], dir).trim(), 'feat/trabajo');
    // Y el trabajo del coder está ahí: es lo que el reviewer viene a mirar.
    assert.match(git(['log', '-1', '--format=%s'], dir).trim(), /trabajo del coder/);
    // Ninguna rama nueva.
    const ramas = git(['branch', '--format=%(refname:short)']).split('\n').map((s) => s.trim()).filter(Boolean).sort();
    assert.deepEqual(ramas, ['feat/trabajo', 'main']);
  });

  it('branch-busy: la rama ya checkouteada en otro worktree se rechaza con SU PROPIA razón', () => {
    // Simula la sesión del coder todavía viva sobre esa rama.
    const ocupado = join(repo, '.claude', 'worktrees', 'coder');
    git(['worktree', 'add', '-q', ocupado, 'feat/trabajo']);

    const r = provisionReviewWorktree({ projectPath: repo, branch: 'feat/trabajo', sessionId: 'sid-2' });
    assert.equal(r.ok, false);
    assert.equal(
      /** @type {any} */ (r).reason,
      'branch-busy',
      'el operador tiene que poder distinguir «espera a que cierre» de «git está roto»',
    );
  });

  it('es idempotente: relanzar con el mismo sessionId reutiliza el worktree', () => {
    const a = provisionReviewWorktree({ projectPath: repo, branch: 'feat/trabajo', sessionId: 'sid-3' });
    const b = provisionReviewWorktree({ projectPath: repo, branch: 'feat/trabajo', sessionId: 'sid-3' });
    assert.equal(/** @type {any} */ (a).created, true);
    assert.equal(/** @type {any} */ (b).created, false);
    assert.equal(/** @type {any} */ (b).path, /** @type {any} */ (a).path);
  });

  it('retirar un worktree que ya no está es el estado deseado, no un fallo', () => {
    const r = removeReviewWorktree({ projectPath: repo, path: join(repo, 'no-existe') });
    assert.deepEqual(r, { ok: true, removed: false });
  });

  it('retira el worktree creado', () => {
    const p = /** @type {any} */ (provisionReviewWorktree({ projectPath: repo, branch: 'feat/trabajo', sessionId: 'sid-4' })).path;
    assert.deepEqual(removeReviewWorktree({ projectPath: repo, path: p }), { ok: true, removed: true });
    assert.ok(!existsSync(p));
  });

  it('rechaza entrada incompleta sin tocar git', () => {
    const r = provisionReviewWorktree(/** @type {any} */ ({ projectPath: repo }));
    assert.equal(/** @type {any} */ (r).reason, 'bad-input');
  });

  it('resolveBaseBranch encuentra main sin origin', () => {
    assert.equal(resolveBaseBranch(repo), 'main');
  });
});
