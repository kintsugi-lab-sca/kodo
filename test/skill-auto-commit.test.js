// @ts-check
//
// test/skill-auto-commit.test.js — Phase 999.1 D-16 coverage.
//
// Verifica el contrato auto-commit de handleOrchestratorStop en src/hooks/stop.js:
//   A) cambios sin commit en .claude/skills/ → git commit con mensaje canónico
//      (skill: orchestrator learnings YYYY-MM-DD), SOLO con el marcador orquestador
//   B) sin cambios → no-op silencioso + mensaje informativo a stderr
//   C) Phase 72 HYG-01 — SIN KODO_ORCHESTRATOR=1 → skip silencioso aunque haya
//      cambios sin commitear (gate D-06: cero commits fantasma en sesiones normales)
//
// Patrón: spawnSync child (canon Phase 16 LOG-15 + Phase 17 UAT-03) con HOME y
// KODO_ROOT inyectados como env vars al child, repo tmpdir sembrado con git init
// local. El hook resuelve KODO_ROOT desde process.env (Plan 03 Edit 1: env
// override aditivo); HOME aísla state.json/locks.
//
// Phase 72 HYG-01: el auto-commit está ahora GATED por `KODO_ORCHESTRATOR=1`
// (marcador de sesión orquestadora, inyectado por launchOrchestrator) y su
// pathspec se restringe a `.claude/skills/kodo-orchestrate/` en add y commit. El
// child spawn inyecta el marcador para reproducir la sesión orquestadora real.
//
// Aislamiento (CR-02 Phase 16): mkdtempSync + git init local + git config local.
// NUNCA toca el repo del desarrollador ni el gitconfig global.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const STOP_HOOK = join(REPO, 'src', 'hooks', 'stop.js');

/**
 * Setup an isolated git workdir with .claude/skills/ initialized + committed.
 * Returns { tmpHome, tmpRepo } so the test can clean up both.
 *
 * Crea DOS tmpdirs separados (HOME + repo) por test:
 *   - tmpHome: aísla state.json/locks/config.json del usuario real.
 *   - tmpRepo: workdir git aislado donde el hook escribirá el commit.
 *
 * git config se aplica LOCAL al repo del tmpdir — NUNCA toca el gitconfig
 * del desarrollador. commit.gpgsign false desactiva prompts GPG en CI.
 */
function makeIsolatedRepo() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-skill-home-'));
  const tmpRepo = mkdtempSync(join(tmpdir(), 'kodo-skill-repo-'));

  // ~/.kodo/ dentro del HOME aislado — state.js lo necesita para no fallar al
  // resolver KODO_DIR; aunque el path orchestrator-stop no toca state.json,
  // ser explícito previene side-effects si el flujo cambia.
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });

  const gitOpts = { cwd: tmpRepo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
  const run = (cmd) => execSync(cmd, gitOpts);

  run('git init -q');
  run('git config user.email "test@kodo.local"');
  run('git config user.name "kodo test"');
  // Disable GPG signing locally to avoid prompts en CI con gpg.commitsign=true global.
  run('git config commit.gpgsign false');

  mkdirSync(join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate'), { recursive: true });
  writeFileSync(
    join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate', 'skill.md'),
    '# kodo:orchestrate\n\nInitial skill body.\n',
    'utf-8',
  );
  run('git add .claude/');
  run('git commit -q -m "initial"');

  return { tmpHome, tmpRepo };
}

/**
 * Spawn the hook as a child process with HOME + KODO_ROOT overridden.
 * Mirrors the canonical pattern from test/session-of-resolver.test.js.
 *
 * CRÍTICO: sin `KODO_ROOT: tmpRepo` el hook usaría `join(__dirname, '..', '..')`
 * que apunta al repo REAL del desarrollador. El env override es la única
 * defensa contra commitear sobre `~/dev/klab/kodo` durante los tests
 * (T-999.1.04-02 mitigation).
 *
 * Phase 72 HYG-01: por defecto inyecta `KODO_ORCHESTRATOR=1` (sesión
 * orquestadora). Con `orchestrator: false` se omite el marcador para ejercitar
 * el skip del gate (test C).
 *
 * @param {{ tmpHome: string, tmpRepo: string, sessionId: string, orchestrator?: boolean }} args
 * @returns {ReturnType<typeof spawnSync>}
 */
function runStopHookChild({ tmpHome, tmpRepo, sessionId, orchestrator = true }) {
  const env = { ...process.env, HOME: tmpHome, KODO_ROOT: tmpRepo };
  // Aseguramos que el marcador no se herede del entorno del runner cuando el
  // test lo quiere ausente (gate cerrado).
  delete env.KODO_ORCHESTRATOR;
  if (orchestrator) env.KODO_ORCHESTRATOR = '1';
  return spawnSync(
    process.execPath,
    [STOP_HOOK],
    {
      cwd: tmpRepo,
      env,
      input: JSON.stringify({ session_id: sessionId, cwd: tmpRepo }),
      encoding: 'utf-8',
      timeout: 10000, // T-999.1.04-03 DoS mitigation
    },
  );
}

/** Helper: run git in tmpRepo and return trimmed stdout. */
function git(tmpRepo, cmd) {
  return execSync(`git ${cmd}`, { cwd: tmpRepo, encoding: 'utf-8' }).trim();
}

describe('D-16: handleOrchestratorStop auto-commit (spawnSync canon)', () => {
  let tmpHome;
  let tmpRepo;

  afterEach(() => {
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
    if (tmpRepo) rmSync(tmpRepo, { recursive: true, force: true });
    tmpHome = undefined;
    tmpRepo = undefined;
  });

  it('A: commits when .claude/skills/ has uncommitted changes', () => {
    ({ tmpHome, tmpRepo } = makeIsolatedRepo());
    const headBefore = git(tmpRepo, 'rev-parse HEAD');
    const countBefore = parseInt(git(tmpRepo, 'rev-list --count HEAD'), 10);

    // Dirty the working tree
    appendFileSync(
      join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate', 'skill.md'),
      '- [2026-05-11] new learning\n',
      'utf-8',
    );

    const result = runStopHookChild({
      tmpHome,
      tmpRepo,
      sessionId: 'orch-test-A',
    });

    assert.equal(
      result.status,
      0,
      `hook should exit 0 (silent-failure); stderr: ${result.stderr}`,
    );

    const lastSubject = git(tmpRepo, 'log --format=%s -n 1');
    assert.match(
      lastSubject,
      /^skill: orchestrator learnings \d{4}-\d{2}-\d{2}$/,
      'commit subject canonical',
    );

    const status = git(tmpRepo, 'status --porcelain');
    assert.equal(status, '', 'working tree clean after auto-commit');

    const countAfter = parseInt(git(tmpRepo, 'rev-list --count HEAD'), 10);
    assert.equal(countAfter, countBefore + 1, 'exactly one new commit created');

    const headAfter = git(tmpRepo, 'rev-parse HEAD');
    assert.notEqual(headAfter, headBefore, 'HEAD advanced');
  });

  it('B: no-ops silently when .claude/skills/ has no changes', () => {
    ({ tmpHome, tmpRepo } = makeIsolatedRepo());
    const headBefore = git(tmpRepo, 'rev-parse HEAD');
    const countBefore = parseInt(git(tmpRepo, 'rev-list --count HEAD'), 10);

    const result = runStopHookChild({
      tmpHome,
      tmpRepo,
      sessionId: 'orch-test-B',
    });

    assert.equal(result.status, 0, `hook should exit 0; stderr: ${result.stderr}`);

    const headAfter = git(tmpRepo, 'rev-parse HEAD');
    const countAfter = parseInt(git(tmpRepo, 'rev-list --count HEAD'), 10);
    assert.equal(headAfter, headBefore, 'HEAD unchanged');
    assert.equal(countAfter, countBefore, 'commit count unchanged');

    const lastSubject = git(tmpRepo, 'log --format=%s -n 1');
    assert.equal(lastSubject, 'initial', 'last commit is still "initial"');

    assert.ok(
      result.stderr.includes('no skill changes to commit'),
      `stderr should mention "no skill changes to commit"; got: ${JSON.stringify(result.stderr)}`,
    );
  });

  it('C: HYG-01 — sin KODO_ORCHESTRATOR skip aunque haya cambios (cero commits fantasma)', () => {
    ({ tmpHome, tmpRepo } = makeIsolatedRepo());
    const headBefore = git(tmpRepo, 'rev-parse HEAD');
    const countBefore = parseInt(git(tmpRepo, 'rev-list --count HEAD'), 10);

    // Árbol sucio en la skill: en la sesión orquestadora esto commitearía, pero
    // sin el marcador el gate debe saltar sin tocar git.
    appendFileSync(
      join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate', 'skill.md'),
      '- [2026-07-13] learning en sesión NO orquestadora\n',
      'utf-8',
    );

    const result = runStopHookChild({
      tmpHome,
      tmpRepo,
      sessionId: 'orch-test-C',
      orchestrator: false, // sin KODO_ORCHESTRATOR=1
    });

    assert.equal(result.status, 0, `hook should exit 0; stderr: ${result.stderr}`);

    const headAfter = git(tmpRepo, 'rev-parse HEAD');
    const countAfter = parseInt(git(tmpRepo, 'rev-list --count HEAD'), 10);
    assert.equal(headAfter, headBefore, 'HEAD unchanged (no auto-commit sin el marcador)');
    assert.equal(countAfter, countBefore, 'commit count unchanged');

    // El cambio sigue sin commitear — el gate no tocó el árbol.
    const status = git(tmpRepo, 'status --porcelain');
    assert.ok(status.includes('skill.md'), 'el cambio del dev permanece staged/unstaged, intacto');

    assert.ok(
      result.stderr.includes('no es sesión orquestadora'),
      `stderr should mention the gate skip; got: ${JSON.stringify(result.stderr)}`,
    );
  });
});
