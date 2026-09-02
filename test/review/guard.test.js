// @ts-check
//
// test/review/guard.test.js — KODO-75: la restricción de escritura del reviewer.
//
// ═══ LA MORDIDA DELIBERADA ═══
//
// La tarea lo pide con esas palabras: «el pathspec de escritura es la garantía de que el
// reviewer no "arregla" lo que debía criticar. Verificarlo con una mordida deliberada».
//
// Así que el test central de este fichero no comprueba que el camino feliz funcione — eso es
// lo fácil. Comprueba que un reviewer que HACE justo lo que no debe (editar código de
// producción, tocar un test, borrar un script de build) no consigue que nada de eso entre en
// el commit. Sobre un repo git REAL en tmpdir, con `git` de verdad: un mock del pathspec
// probaría que el mock funciona, no que la restricción existe.
//
// Se prueban las dos mitades del mecanismo por separado, porque cualquiera de ellas sola deja
// un hueco:
//   - el pathspec del `add`    → limita lo que entra al ÍNDICE;
//   - el pathspec del `commit` → limita lo que entra al COMMIT aunque el índice llegara sucio.
// El segundo caso (índice pre-staged) es el que se cuela si solo se restringe el `add`.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classifyPaths,
  commitReviewArtifacts,
  inspectWorkingTree,
  isReviewPath,
  parsePorcelainPaths,
} from '../../src/review/guard.js';

/** @type {string} */
let repo;

/** `git` real sobre el repo del fixture. */
function git(args, cwd = repo) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
}

/** Ficheros que el commit ACABÓ tocando, según el propio git. La fuente de verdad del test. */
function filesInHead() {
  return git(['show', '--name-only', '--format=', 'HEAD'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'kodo-guard-'));
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  // El repo arranca con código de producción y un test, que es lo que el reviewer NO puede tocar.
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'test'), { recursive: true });
  mkdirSync(join(repo, 'scripts'), { recursive: true });
  writeFileSync(join(repo, 'src', 'produccion.js'), 'export const v = 1;\n');
  writeFileSync(join(repo, 'test', 'produccion.test.js'), '// test original\n');
  writeFileSync(join(repo, 'scripts', 'build.sh'), '#!/bin/sh\necho build\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

/** Escribe un artefacto de revisión legítimo. */
function writeArtifact(name = 'approval.md', body = '---\ncommit: deadbee\n---\nok\n') {
  mkdirSync(join(repo, 'review', 'recommendations'), { recursive: true });
  const path = name.includes('recommendations') && name !== 'approval.md'
    ? join(repo, 'review', 'recommendations', name)
    : join(repo, 'review', name);
  writeFileSync(path, body);
}

describe('KODO-75 — isReviewPath: el matiz que evita el agujero del prefijo', () => {
  it('acepta ficheros bajo review/', () => {
    assert.equal(isReviewPath('review/approval.md'), true);
    assert.equal(isReviewPath('review/recommendations/001-recommendations.md'), true);
  });

  it('RECHAZA un directorio hermano cuyo nombre empieza igual — startsWith() dejaría pasar esto', () => {
    assert.equal(isReviewPath('reviewers/hack.js'), false);
    assert.equal(isReviewPath('review-notes/x.md'), false);
    assert.equal(isReviewPath('reviewed.js'), false);
  });

  it('RECHAZA rutas que se salen del árbol con ..', () => {
    assert.equal(isReviewPath('review/../src/produccion.js'), false);
    assert.equal(isReviewPath('../review/x.md'), false);
  });

  it('RECHAZA `review` a secas: el directorio no es un cambio commiteable', () => {
    assert.equal(isReviewPath('review'), false);
    assert.equal(isReviewPath('review/'), false);
  });

  it('RECHAZA review/ anidado bajo otra cosa', () => {
    assert.equal(isReviewPath('src/review/x.md'), false);
  });
});

describe('KODO-75 — parsePorcelainPaths', () => {
  it('conserva las rutas con espacios (la ruta es todo lo que va tras la columna 3)', () => {
    assert.deepEqual(parsePorcelainPaths(' M src/un fichero.js'), ['src/un fichero.js']);
  });

  it('en un rename se queda con el DESTINO, que es donde acabó el contenido', () => {
    assert.deepEqual(parsePorcelainPaths('R  vieja.js -> nueva.js'), ['nueva.js']);
  });

  it('reparte una salida mixta', () => {
    const { inside, outside } = classifyPaths(
      parsePorcelainPaths('?? review/approval.md\n M src/produccion.js\n'),
    );
    assert.deepEqual(inside, ['review/approval.md']);
    assert.deepEqual(outside, ['src/produccion.js']);
  });
});

describe('KODO-75 — el GATE KODO_REVIEWER', () => {
  it('sin el marcador NO commitea nada, aunque haya artefactos válidos', () => {
    writeArtifact();
    const r = commitReviewArtifacts({ dir: repo, message: 'review: x' }, { env: {} });
    assert.equal(r.ok, false);
    assert.equal(/** @type {any} */ (r).reason, 'not-reviewer-session');
    assert.equal(git(['rev-list', '--count', 'HEAD']).trim(), '1', 'no se creó ningún commit');
  });

  it('un valor distinto de "1" tampoco abre el gate', () => {
    writeArtifact();
    for (const v of ['0', 'true', 'yes', '']) {
      const r = commitReviewArtifacts({ dir: repo, message: 'x' }, { env: { KODO_REVIEWER: v } });
      assert.equal(/** @type {any} */ (r).reason, 'not-reviewer-session', `valor ${JSON.stringify(v)}`);
    }
  });
});

describe('KODO-75 — LA MORDIDA DELIBERADA: el reviewer intenta arreglar en vez de criticar', () => {
  it('edita código de producción Y escribe su artefacto → SOLO el artefacto entra en el commit', () => {
    // El reviewer hace exactamente lo que la restricción existe para impedir.
    writeFileSync(join(repo, 'src', 'produccion.js'), 'export const v = 2; // "arreglado" por el reviewer\n');
    writeArtifact('approval.md');

    const r = commitReviewArtifacts(
      { dir: repo, message: 'review: aprobación' },
      { env: { KODO_REVIEWER: '1' } },
    );

    assert.equal(r.ok, true);
    assert.equal(/** @type {any} */ (r).committed, true);
    assert.deepEqual(
      filesInHead(),
      ['review/approval.md'],
      'el commit debe contener EXCLUSIVAMENTE el artefacto de revisión',
    );
    // Y el "arreglo" sigue en el working tree, sin commitear: no se pierde en silencio.
    assert.match(
      readFileSync(join(repo, 'src', 'produccion.js'), 'utf-8'),
      /v = 2/,
      'la edición sigue en el working tree — el reviewer puede verla, pero no la commitea',
    );
    assert.deepEqual(
      /** @type {any} */ (r).skipped,
      ['src/produccion.js'],
      'y se REPORTA lo que quedó fuera: un cambio descartado en silencio sería el único daño posible',
    );
  });

  it('muerde en los tres carriles a la vez (producción, tests, build) y no consigue ninguno', () => {
    writeFileSync(join(repo, 'src', 'produccion.js'), 'export const v = 99;\n');
    writeFileSync(join(repo, 'test', 'produccion.test.js'), '// test debilitado por el reviewer\n');
    writeFileSync(join(repo, 'scripts', 'build.sh'), '#!/bin/sh\nexit 0\n');
    writeArtifact('001-recommendations.md', '---\ncommit: deadbee\nround: 1\n---\nThings To Address\n');

    const r = commitReviewArtifacts({ dir: repo, message: 'review: ronda 1' }, { env: { KODO_REVIEWER: '1' } });

    assert.equal(/** @type {any} */ (r).committed, true);
    assert.deepEqual(filesInHead(), ['review/recommendations/001-recommendations.md']);
    assert.deepEqual(
      /** @type {any} */ (r).skipped.sort(),
      ['scripts/build.sh', 'src/produccion.js', 'test/produccion.test.js'],
    );
  });

  it('intenta BORRAR un fichero de producción → el borrado no entra en el commit', () => {
    rmSync(join(repo, 'scripts', 'build.sh'));
    writeArtifact();

    const r = commitReviewArtifacts({ dir: repo, message: 'review: x' }, { env: { KODO_REVIEWER: '1' } });

    assert.equal(/** @type {any} */ (r).committed, true);
    assert.deepEqual(filesInHead(), ['review/approval.md']);
    // El fichero sigue en HEAD aunque no esté en el working tree: el borrado no se commiteó.
    assert.match(git(['ls-tree', '--name-only', 'HEAD', 'scripts/']), /build\.sh/);
  });

  it('EL HUECO DEL ÍNDICE SUCIO: con código YA staged de antes, el commit sigue llevándose solo review/', () => {
    // Éste es el caso que se cuela si el pathspec solo está en el `add`. El reviewer (o
    // cualquier cosa antes que él) dejó producción en el índice; `git commit` sin pathspec se
    // lo llevaría por delante.
    writeFileSync(join(repo, 'src', 'produccion.js'), 'export const v = 3;\n');
    git(['add', 'src/produccion.js']);
    assert.match(git(['diff', '--cached', '--name-only']), /src\/produccion\.js/, 'precondición: índice sucio');

    writeArtifact();
    const r = commitReviewArtifacts({ dir: repo, message: 'review: x' }, { env: { KODO_REVIEWER: '1' } });

    assert.equal(/** @type {any} */ (r).committed, true);
    assert.deepEqual(
      filesInHead(),
      ['review/approval.md'],
      'el pathspec del COMMIT es lo que cierra este hueco — sin él, produccion.js habría entrado',
    );
    // Y sigue staged, intacto: el commit lo ignoró, no lo revirtió.
    assert.match(git(['diff', '--cached', '--name-only']), /src\/produccion\.js/);
  });

  it('un reviewer que SOLO toca código y no escribe artefacto no consigue ningún commit', () => {
    writeFileSync(join(repo, 'src', 'produccion.js'), 'export const v = 4;\n');

    const r = commitReviewArtifacts({ dir: repo, message: 'review: x' }, { env: { KODO_REVIEWER: '1' } });

    assert.equal(r.ok, true);
    assert.equal(/** @type {any} */ (r).committed, false);
    assert.equal(/** @type {any} */ (r).reason, 'nothing-to-commit');
    assert.equal(git(['rev-list', '--count', 'HEAD']).trim(), '1');
    assert.deepEqual(/** @type {any} */ (r).skipped, ['src/produccion.js']);
  });

  it('un directorio hermano `reviewers/` NO cuela por el pathspec', () => {
    mkdirSync(join(repo, 'reviewers'), { recursive: true });
    writeFileSync(join(repo, 'reviewers', 'hack.js'), 'export const puerta = true;\n');
    writeArtifact();

    const r = commitReviewArtifacts({ dir: repo, message: 'review: x' }, { env: { KODO_REVIEWER: '1' } });

    assert.deepEqual(filesInHead(), ['review/approval.md']);
    assert.ok(existsSync(join(repo, 'reviewers', 'hack.js')), 'sigue en disco, sin commitear');
    assert.deepEqual(/** @type {any} */ (r).skipped, ['reviewers/hack.js']);
  });
});

describe('KODO-75 — camino feliz y diagnóstico', () => {
  it('commitea el artefacto y devuelve su SHA', () => {
    writeArtifact();
    const r = /** @type {any} */ (commitReviewArtifacts({ dir: repo, message: 'review: ok' }, { env: { KODO_REVIEWER: '1' } }));
    assert.equal(r.committed, true);
    assert.match(r.sha, /^[0-9a-f]{40}$/);
    assert.deepEqual(r.skipped, []);
    assert.match(git(['log', '-1', '--format=%s']).trim(), /review: ok/);
  });

  it('inspectWorkingTree reparte dentro/fuera sobre un repo real', () => {
    writeFileSync(join(repo, 'src', 'produccion.js'), 'export const v = 5;\n');
    writeArtifact();
    const r = /** @type {any} */ (inspectWorkingTree(repo));
    assert.equal(r.ok, true);
    assert.deepEqual(r.inside, ['review/approval.md']);
    assert.deepEqual(r.outside, ['src/produccion.js']);
  });

  it('never-throws: un directorio que no es repo git degrada a git-failed, no a excepción', () => {
    const noRepo = mkdtempSync(join(tmpdir(), 'kodo-norepo-'));
    try {
      const r = /** @type {any} */ (inspectWorkingTree(noRepo));
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'git-failed');
    } finally {
      rmSync(noRepo, { recursive: true, force: true });
    }
  });
});
