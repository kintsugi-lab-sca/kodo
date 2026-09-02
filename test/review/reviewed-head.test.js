// @ts-check
//
// test/review/reviewed-head.test.js — KODO-75: el ANCLA, contra git REAL.
//
// POR QUÉ ESTE FICHERO EXISTE APARTE. `artifacts.test.js` cubre la derivación inyectando el
// `reviewedHead` ya resuelto, que es lo correcto para congelar la lógica de precedencia sin
// depender de git. Pero deja SIN cubrir la pieza de la que depende todo lo demás: que
// `resolveReviewedHead` —o sea, el magic pathspec `git log -1 --format=%H -- . ':(exclude)review'`—
// se comporte de verdad como dice la cabecera del módulo.
//
// Y esa pieza tiene una propiedad no obvia que, si falla, rompe la feature entera sin que
// ningún test con mocks se entere:
//
//   el commit del PROPIO reviewer no debe mover el reviewedHead.
//
// Si lo moviera, el `commit:` que el reviewer acaba de escribir sería stale un segundo
// después de escribirlo y NINGUNA rama estaría jamás aprobada. Es el bug que motivó elegir el
// reviewedHead en vez del HEAD, y solo se puede comprobar con commits de verdad.
//
// El test recorre el ciclo completo —coder trabaja → reviewer pide cambios → coder arregla →
// reviewer aprueba → coder empuja después— sobre un repo git real, y comprueba el estado
// derivado en cada paso.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveReviewState, resolveReviewedHead, reviewConfidence } from '../../src/review/artifacts.js';
import { commitReviewArtifacts } from '../../src/review/guard.js';

/** @type {string} */
let repo;
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' }).trim();

/** El reviewer escribe un artefacto y lo commitea por el carril real (gate + pathspec). */
function reviewerCommits(relPath, body) {
  const full = join(repo, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  return commitReviewArtifacts(
    { dir: repo, message: `review: ${relPath}` },
    { env: { KODO_REVIEWER: '1' } },
  );
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'kodo-anchor-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'p.js'), '1\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('KODO-75 — resolveReviewedHead contra git real', () => {
  it('sin artefactos de revisión, el reviewedHead ES el HEAD', () => {
    assert.equal(resolveReviewedHead(repo), git('rev-parse', 'HEAD'));
  });

  it('LA PROPIEDAD CLAVE: un commit que solo toca review/ NO mueve el reviewedHead', () => {
    const antes = resolveReviewedHead(repo);
    const headAntes = git('rev-parse', 'HEAD');

    const r = reviewerCommits('review/approval.md', `---\ncommit: ${antes}\n---\nok\n`);
    assert.equal(/** @type {any} */ (r).committed, true);

    assert.notEqual(git('rev-parse', 'HEAD'), headAntes, 'precondición: el HEAD SÍ se movió');
    assert.equal(
      resolveReviewedHead(repo),
      antes,
      'si el commit del reviewer moviera el ancla, su propia aprobación nacería caducada y NINGUNA rama estaría jamás aprobada',
    );
  });

  it('un commit de código SÍ mueve el reviewedHead', () => {
    const antes = resolveReviewedHead(repo);
    writeFileSync(join(repo, 'src', 'p.js'), '2\n');
    git('commit', '-q', '-am', 'trabajo');
    assert.notEqual(resolveReviewedHead(repo), antes);
    assert.equal(resolveReviewedHead(repo), git('rev-parse', 'HEAD'));
  });

  it('un commit MIXTO (código + review/) mueve el ancla: el código es lo que manda', () => {
    writeFileSync(join(repo, 'src', 'p.js'), '3\n');
    mkdirSync(join(repo, 'review'), { recursive: true });
    writeFileSync(join(repo, 'review', 'notas.md'), 'x\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'mixto');
    assert.equal(resolveReviewedHead(repo), git('rev-parse', 'HEAD'));
  });
});

describe('KODO-75 — el ciclo completo sobre un repo real', () => {
  it('coder → cambios pedidos → coder arregla → aprobación → trabajo posterior caduca la aprobación', () => {
    // 1. El coder trabaja.
    writeFileSync(join(repo, 'src', 'p.js'), '2\n');
    git('commit', '-q', '-am', 'trabajo del coder');
    const head1 = resolveReviewedHead(repo);
    assert.equal(deriveReviewState({ dir: repo }).state, 'none');
    assert.equal(reviewConfidence(deriveReviewState({ dir: repo })), 'unreviewed');

    // 2. El reviewer pide cambios (ronda 1), por el carril real.
    reviewerCommits(
      'review/recommendations/001-recommendations.md',
      `---\nbranch: main\ncommit: ${head1}\nround: 1\n---\nThings To Address\n`,
    );
    const s2 = /** @type {any} */ (deriveReviewState({ dir: repo }));
    assert.equal(s2.state, 'changes-requested');
    assert.equal(s2.round, 1);
    assert.equal(reviewConfidence(s2), 'changes-requested');

    // 3. El coder arregla. El ancla se mueve.
    writeFileSync(join(repo, 'src', 'p.js'), '3\n');
    git('commit', '-q', '-am', 'arreglos del coder');
    const head2 = resolveReviewedHead(repo);
    assert.notEqual(head2, head1);

    // 4. El reviewer aprueba anclando al ancla NUEVA.
    reviewerCommits('review/approval.md', `---\nbranch: main\ncommit: ${head2}\n---\nRevisado.\n`);
    const s4 = deriveReviewState({ dir: repo });
    assert.equal(s4.state, 'approved', 'la aprobación sobrevive a su propio commit');
    assert.equal(reviewConfidence(s4), 'reviewed', 'y ES lo que sube la confianza de la cola');

    // 5. El coder empuja DESPUÉS de aprobar → la aprobación caduca sola.
    writeFileSync(join(repo, 'src', 'p.js'), '4\n');
    git('commit', '-q', '-am', 'trabajo posterior a la aprobación');
    const s5 = deriveReviewState({ dir: repo });
    assert.equal(s5.state, 'stale-approval');
    assert.equal(
      reviewConfidence(s5),
      'stale',
      'una aprobación de código que ya no es el código que hay JAMÁS vale como revisada',
    );
  });

  it('si el reviewer aprueba con un ancla vieja, el estado es stale — no basta con escribir el fichero', () => {
    const viejo = resolveReviewedHead(repo);
    writeFileSync(join(repo, 'src', 'p.js'), '9\n');
    git('commit', '-q', '-am', 'trabajo nuevo sin revisar');

    reviewerCommits('review/approval.md', `---\ncommit: ${viejo}\n---\nAprobado (pero del código viejo)\n`);

    assert.equal(deriveReviewState({ dir: repo }).state, 'stale-approval');
  });
});
