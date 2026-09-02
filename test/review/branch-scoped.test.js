// @ts-check
//
// test/review/branch-scoped.test.js — regresiones del review de la PR #4.
//
// Los tres agujeros que cubre este fichero tienen la misma raíz: el estado de revisión es un
// hecho de la RAMA, y leerlo del árbol de un directorio cualquiera responde por lo que ese
// directorio tenga checkouteado — normalmente `main`.
//
//   (a) `unreviewed` eterno — los artefactos de la rama no están en el árbol de main, así que
//       el gate no se abría nunca.
//   (b) FALSO `approved` — en cuanto una tarea revisada mergea, su `review/` vive en main;
//       preguntar por otra rama leía ESE approval y, si su `commit:` casaba con el reviewed
//       head de main, respondía «aprobada». Una rama que nadie ha mirado, reportada como
//       revisada: el fallo exacto que la feature existe para eliminar, por el lado de la
//       lectura.
//   (c) `stale-approval` heredado — toda rama que sale de main hereda ese `review/`, así que
//       una rama virgen reportaba «aprobación caducada» en vez de «sin revisar».
//
// (b) no es un caso raro: es el estado normal en cuanto existe la SEGUNDA tarea revisada.
//
// Todo contra git real: con mocks del `gitFn` estaríamos probando el mock, no la propiedad.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveReviewState,
  readReviewArtifactsFromBranch,
  resolveReviewedHead,
  reviewConfidence,
} from '../../src/review/artifacts.js';

/** @type {string} */
let repo;
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' }).trim();

/** Escribe y commitea un artefacto de revisión en la rama actual. */
function commitArtifact(rel, body) {
  const full = join(repo, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, body);
  git('add', 'review/');
  git('commit', '-q', '-m', `review: ${rel}`);
}

/** Reviewed head de la rama actual (el ancla que el reviewer escribiría). */
function anchor() {
  return git('log', '-1', '--format=%H', '--', '.', ':(exclude)review');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'kodo-branchscope-'));
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

/**
 * Monta el escenario que rompía: la tarea A revisada y MERGEADA (su review/ ya vive en main),
 * y la tarea B con trabajo nuevo que nadie ha revisado. El operador consulta desde main.
 */
function scenarioAmergedBunreviewed() {
  git('checkout', '-q', '-b', 'feat/tarea-a');
  writeFileSync(join(repo, 'src', 'p.js'), 'A\n');
  git('commit', '-q', '-am', 'trabajo A');
  commitArtifact('review/approval.md', `---\nbranch: feat/tarea-a\ncommit: ${anchor()}\n---\nAprobada A\n`);
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'merge tarea A', 'feat/tarea-a');

  git('checkout', '-q', '-b', 'feat/tarea-b');
  writeFileSync(join(repo, 'src', 'p.js'), 'B\n');
  git('commit', '-q', '-am', 'trabajo B sin revisar');
  git('checkout', '-q', 'main'); // el CLI consulta desde el repo, que tiene main
}

describe('PR #4 — la lectura es de la RAMA, no del checkout', () => {
  it('lee los artefactos de una rama que NO está checkouteada', () => {
    git('checkout', '-q', '-b', 'feat/x');
    writeFileSync(join(repo, 'src', 'p.js'), '2\n');
    git('commit', '-q', '-am', 'trabajo');
    const a = anchor();
    commitArtifact('review/approval.md', `---\nbranch: feat/x\ncommit: ${a}\n---\nok\n`);
    git('checkout', '-q', 'main');

    // Desde main, sin nada de review/ en su árbol.
    const r = readReviewArtifactsFromBranch(repo, 'feat/x');
    assert.ok(r.approval, 'el approval de la rama se lee aunque main no lo tenga');
    assert.equal(/** @type {any} */ (r.approval.frontmatter).commit, a);
  });

  it('(a) REGRESIÓN: una rama revisada ya no se reporta `unreviewed` desde main', () => {
    git('checkout', '-q', '-b', 'feat/y');
    writeFileSync(join(repo, 'src', 'p.js'), '2\n');
    git('commit', '-q', '-am', 'trabajo');
    commitArtifact('review/approval.md', `---\nbranch: feat/y\ncommit: ${anchor()}\n---\nok\n`);
    git('checkout', '-q', 'main');

    const s = deriveReviewState({ dir: repo, branch: 'feat/y' });
    assert.equal(s.state, 'approved');
    assert.equal(reviewConfidence(s), 'reviewed');
  });

  it('el ancla también sale de la RAMA, no del HEAD del checkout', () => {
    git('checkout', '-q', '-b', 'feat/z');
    writeFileSync(join(repo, 'src', 'p.js'), '2\n');
    git('commit', '-q', '-am', 'trabajo z');
    const anclaRama = anchor();
    git('checkout', '-q', 'main');

    assert.equal(resolveReviewedHead(repo, { branch: 'feat/z' }), anclaRama);
    assert.notEqual(
      resolveReviewedHead(repo),
      anclaRama,
      'sin branch se resuelve contra main — que es justo lo que hacía mal el CLI',
    );
  });

  it('las recomendaciones también se leen por rama', () => {
    git('checkout', '-q', '-b', 'feat/w');
    writeFileSync(join(repo, 'src', 'p.js'), '2\n');
    git('commit', '-q', '-am', 'trabajo');
    commitArtifact(
      'review/recommendations/001-recommendations.md',
      `---\nbranch: feat/w\ncommit: ${anchor()}\nround: 1\n---\nThings To Address\n`,
    );
    git('checkout', '-q', 'main');

    const s = /** @type {any} */ (deriveReviewState({ dir: repo, branch: 'feat/w' }));
    assert.equal(s.state, 'changes-requested');
    assert.equal(s.round, 1);
  });
});

describe('PR #4 — (b) EL FALSO APPROVED: el fallo grave', () => {
  it('una rama que NADIE ha revisado no se reporta aprobada por el review/ de otra tarea', () => {
    scenarioAmergedBunreviewed();

    const s = deriveReviewState({ dir: repo, branch: 'feat/tarea-b' });
    assert.notEqual(
      s.state,
      'approved',
      'jamás debe aprobar una rama que nadie ha mirado — es el fallo que la feature elimina',
    );
    assert.equal(s.state, 'none', 'y la respuesta correcta es «sin revisar»');
    assert.equal(reviewConfidence(s), 'unreviewed');
  });

  it('la tarea que SÍ fue aprobada sigue leyéndose como aprobada', () => {
    scenarioAmergedBunreviewed();
    // El arreglo no puede lograr el «no aprueba nunca» por la vía de no aprobar nada.
    assert.equal(deriveReviewState({ dir: repo, branch: 'feat/tarea-a' }).state, 'approved');
  });
});

describe('PR #4 — (c) artefactos HEREDADOS al ramificar de main', () => {
  it('una rama virgen que heredó el review/ de otra tarea dice «sin revisar», no «caducada»', () => {
    scenarioAmergedBunreviewed();
    // feat/tarea-b tiene review/approval.md en su árbol —lo heredó del merge—, pero declara
    // `branch: feat/tarea-a`. No es suyo.
    const s = deriveReviewState({ dir: repo, branch: 'feat/tarea-b' });
    assert.equal(s.state, 'none');
  });

  it('un artefacto SIN branch: se conserva — solo se descarta ante conflicto explícito', () => {
    git('checkout', '-q', '-b', 'feat/sin-branch');
    writeFileSync(join(repo, 'src', 'p.js'), '2\n');
    git('commit', '-q', '-am', 'trabajo');
    commitArtifact('review/approval.md', `---\ncommit: ${anchor()}\n---\nsin branch declarada\n`);
    git('checkout', '-q', 'main');

    assert.equal(deriveReviewState({ dir: repo, branch: 'feat/sin-branch' }).state, 'approved');
  });

  it('un artefacto con frontmatter roto sigue siendo `malformed`, no se silencia como ajeno', () => {
    git('checkout', '-q', '-b', 'feat/roto');
    writeFileSync(join(repo, 'src', 'p.js'), '2\n');
    git('commit', '-q', '-am', 'trabajo');
    commitArtifact('review/approval.md', '---\nbranch: feat/roto\n---\nsin commit\n');
    git('checkout', '-q', 'main');

    const s = deriveReviewState({ dir: repo, branch: 'feat/roto' });
    assert.equal(
      s.state,
      'malformed',
      'un artefacto que hay que reparar debe decirlo; convertirlo en un `none` mudo lo esconde',
    );
  });
});

describe('PR #4 — la lectura por ÁRBOL se conserva para quien está DENTRO de la rama', () => {
  it('sin `branch`, un artefacto AÚN SIN COMMITEAR cuenta — es lo que necesita el reviewer', () => {
    git('checkout', '-q', '-b', 'feat/dentro');
    writeFileSync(join(repo, 'src', 'p.js'), '2\n');
    git('commit', '-q', '-am', 'trabajo');
    // El reviewer acaba de escribirlo y todavía no lo ha commiteado.
    mkdirSync(join(repo, 'review'), { recursive: true });
    writeFileSync(join(repo, 'review', 'approval.md'), `---\ncommit: ${anchor()}\n---\nborrador\n`);

    assert.equal(
      deriveReviewState({ dir: repo }).state,
      'approved',
      'la lectura por árbol ve lo no commiteado; la lectura por rama, no. Las dos hacen falta.',
    );
    assert.equal(
      deriveReviewState({ dir: repo, branch: 'feat/dentro' }).state,
      'none',
      'por rama todavía no existe: aún no se ha commiteado',
    );
  });
});
